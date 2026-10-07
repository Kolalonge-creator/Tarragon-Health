const rpc = jest.fn();
const staff = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff() }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: unknown) => s !== null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { closeHandbackReviewAction, submitAuditAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const form = { safety_items: ["a"], quality_items: ["b"], quality_max: 4 };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
  staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
});

describe("submitAuditAction", () => {
  const good = { audit: ID, form: JSON.stringify(form), "safety:a": "pass", "quality:b": "3", rationale: "" };
  it("sends a non-lead away without calling the database", async () => {
    staff.mockResolvedValue(null);
    expect(await goes(submitAuditAction(fd(good)))).toBe("REDIRECT:/clinician");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the answers the form holds and returns to the queue", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(submitAuditAction(fd(good)))).toBe("REDIRECT:/clinician/quality?n=audit_submitted");
    expect(rpc).toHaveBeenCalledWith("submit_clinical_audit", { p_audit: ID, p_safety: { a: true }, p_quality: { b: 3 }, p_rationale: "" });
  });
  it("never submits a half-filled form", async () => {
    expect(await goes(submitAuditAction(fd({ ...good, "safety:a": "" })))).toBe(`REDIRECT:/clinician/quality/audits/${ID}?n=audit_incomplete`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a database refusal goes back to the audit with a failure notice, not a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "22023" } });
    expect(await goes(submitAuditAction(fd(good)))).toBe(`REDIRECT:/clinician/quality/audits/${ID}?n=audit_failed`);
  });
  it("a malformed form definition is a failure", async () => {
    expect(await goes(submitAuditAction(fd({ ...good, form: "not json" })))).toBe("REDIRECT:/clinician/quality?n=audit_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("closeHandbackReviewAction", () => {
  it("needs a known outcome and a note of 10 characters", async () => {
    expect(await goes(closeHandbackReviewAction(fd({ review: ID, outcome: "suspend", note: "long enough note" })))).toBe("REDIRECT:/clinician/quality?n=review_failed");
    expect(await goes(closeHandbackReviewAction(fd({ review: ID, outcome: "coaching", note: "short" })))).toBe("REDIRECT:/clinician/quality?n=review_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("closes with a valid outcome and note", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(closeHandbackReviewAction(fd({ review: ID, outcome: "coaching", note: "long enough note" })))).toBe("REDIRECT:/clinician/quality?n=review_closed");
    expect(rpc).toHaveBeenCalledWith("close_handback_review", { p_review: ID, p_outcome: "coaching", p_note: "long enough note" });
  });
  it("reports a database refusal as a failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(closeHandbackReviewAction(fd({ review: ID, outcome: "coaching", note: "long enough note" })))).toBe("REDIRECT:/clinician/quality?n=review_failed");
  });
});

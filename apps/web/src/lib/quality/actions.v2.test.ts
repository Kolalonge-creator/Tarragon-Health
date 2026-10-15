const rpc = jest.fn();
const staff = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff() }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: unknown) => s !== null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { extendTier1Action, followupAction, reassignAuditAction, replyToAuditAction, requestAuditAction, submitAuditAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
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

describe("submitAuditAction, version 2", () => {
  const form2 = { safety_items: ["a"], quality_items: ["b"], quality_max: 4, phases: ["assessment"], avoidability: { scale: ["not_avoidable", "probably_avoidable"] }, scribe_items: ["s"] };
  const base = { audit: ID, form: JSON.stringify(form2), "safety:a": "pass", "quality:b": "3", rationale: "", "phase:assessment": "Thin history", avoidability: "probably_avoidable" };
  it("sends phase comments and the avoidability rating the stored form defined", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(submitAuditAction(fd(base)))).toBe("REDIRECT:/clinician/quality?n=audit_submitted");
    expect(rpc).toHaveBeenCalledWith("submit_clinical_audit", {
      p_audit: ID, p_safety: { a: true }, p_quality: { b: 3 }, p_rationale: "", p_phase_comments: { assessment: "Thin history" }, p_avoidability: "probably_avoidable",
    });
  });
  it("a scribe-drafted note needs its items; they are sent when answered", async () => {
    expect(await goes(submitAuditAction(fd({ ...base, scribe_assisted: "yes" })))).toBe(`REDIRECT:/clinician/quality/audits/${ID}?n=audit_incomplete`);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: {}, error: null });
    await goes(submitAuditAction(fd({ ...base, scribe_assisted: "yes", "scribe:s": "fail" })));
    expect(rpc).toHaveBeenCalledWith("submit_clinical_audit", expect.objectContaining({ p_scribe: { s: false } }));
  });
  it("the second review calls its own function and sends no avoidability", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(submitAuditAction(fd({ ...base, mode: "second" })))).toBe("REDIRECT:/clinician/quality?n=second_review_submitted");
    expect(rpc).toHaveBeenCalledWith("submit_second_audit_review", { p_audit: ID, p_safety: { a: true }, p_quality: { b: 3 }, p_rationale: "", p_phase_comments: { assessment: "Thin history" } });
  });
  it("a refusal (for example the case was not opened) returns a failure notice without the database's words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "open the case file before you submit the audit", code: "23514" } });
    expect(await goes(submitAuditAction(fd(base)))).toBe(`REDIRECT:/clinician/quality/audits/${ID}?n=audit_failed`);
  });
});

describe("the other lead actions (Q7)", () => {
  it("every one sends a non-lead away without calling the database", async () => {
    staff.mockResolvedValue(null);
    for (const fn of [requestAuditAction, reassignAuditAction, followupAction, extendTier1Action]) {
      expect(await goes(fn(fd({ task: ID, audit: ID, reviewer: ID, kind: "close", note: "x".repeat(30), staff: ID, extra: "2", reason: "x".repeat(20) })))).toBe("REDIRECT:/clinician");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requests an audit for a task id only", async () => {
    expect(await goes(requestAuditAction(fd({ task: "not-an-id" })))).toBe("REDIRECT:/clinician/quality?n=request_failed");
    rpc.mockResolvedValue({ data: ID, error: null });
    expect(await goes(requestAuditAction(fd({ task: `  ${ID} ` })))).toBe("REDIRECT:/clinician/quality?n=audit_requested");
    expect(rpc).toHaveBeenCalledWith("request_clinical_audit", { p_task: ID });
  });
  it("reassigns to a chosen reviewer and reports a refusal as a failure", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(reassignAuditAction(fd({ audit: ID, reviewer: ID })))).toBe("REDIRECT:/clinician/quality?n=audit_reassigned");
    expect(rpc).toHaveBeenCalledWith("reassign_clinical_audit", { p_audit: ID, p_reviewer: ID });
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(reassignAuditAction(fd({ audit: ID, reviewer: ID })))).toBe("REDIRECT:/clinician/quality?n=reassign_failed");
    expect(await goes(reassignAuditAction(fd({ audit: ID })))).toBe("REDIRECT:/clinician/quality?n=reassign_failed");
  });
  it("appends a note or closes the follow-up once, each needing 20 characters", async () => {
    const note = "Met the clinician and agreed a plan.";
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(followupAction(fd({ audit: ID, kind: "note", note })))).toBe("REDIRECT:/clinician/quality?n=followup_noted");
    expect(rpc).toHaveBeenLastCalledWith("add_audit_followup_note", { p_audit: ID, p_note: note });
    expect(await goes(followupAction(fd({ audit: ID, kind: "close", note })))).toBe("REDIRECT:/clinician/quality?n=followup_closed");
    expect(rpc).toHaveBeenLastCalledWith("close_audit_followup", { p_audit: ID, p_note: note });
    rpc.mockClear();
    expect(await goes(followupAction(fd({ audit: ID, kind: "close", note: "too short" })))).toBe("REDIRECT:/clinician/quality?n=followup_failed");
    expect(await goes(followupAction(fd({ audit: ID, kind: "delete", note })))).toBe("REDIRECT:/clinician/quality?n=followup_failed");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "already closed", code: "23514" } });
    expect(await goes(followupAction(fd({ audit: ID, kind: "close", note })))).toBe("REDIRECT:/clinician/quality?n=followup_failed");
  });
  it("extends the tier 1 count by 1 to 20 with a reason", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(extendTier1Action(fd({ staff: ID, extra: "5", reason: "needs more oversight" })))).toBe("REDIRECT:/clinician/quality?n=tier1_extended");
    expect(rpc).toHaveBeenCalledWith("extend_tier1_audits", { p_staff: ID, p_extra: 5, p_reason: "needs more oversight" });
    rpc.mockClear();
    for (const bad of [{ extra: "0" }, { extra: "21" }, { extra: "x" }, { reason: "short" }]) {
      expect(await goes(extendTier1Action(fd({ staff: ID, extra: "5", reason: "needs more oversight", ...bad })))).toBe("REDIRECT:/clinician/quality?n=tier1_failed");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("replyToAuditAction", () => {
  it("only a clinician replies, with 20 characters, and the database checks the audit is theirs", async () => {
    staff.mockResolvedValue(null);
    expect(await goes(replyToAuditAction(fd({ audit: ID, body: "x".repeat(30) })))).toBe("REDIRECT:/clinician");
    staff.mockResolvedValue({ doctor_tier: "senior_medical_officer" });
    expect(await goes(replyToAuditAction(fd({ audit: ID, body: "short" })))).toBe("REDIRECT:/clinician/my-quality?n=reply_failed");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(replyToAuditAction(fd({ audit: ID, body: "The patient was already on the emergency pathway." })))).toBe("REDIRECT:/clinician/my-quality?n=reply_sent");
    expect(rpc).toHaveBeenCalledWith("reply_to_clinical_audit", { p_audit: ID, p_body: "The patient was already on the emergency pathway." });
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "P0002" } });
    expect(await goes(replyToAuditAction(fd({ audit: ID, body: "The patient was already on the emergency pathway." })))).toBe("REDIRECT:/clinician/my-quality?n=reply_failed");
  });
});

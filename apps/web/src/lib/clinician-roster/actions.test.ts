const rpc = jest.fn();
const staff = jest.fn();
const perm = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff() }));
jest.mock("@/lib/auth/permissions", () => ({ hasPermission: (k: string) => perm(k) }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: unknown) => s !== null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { leadDecideAction, leadGrantAction, leadReinstateAction, opsRequestAction, opsSuspendAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
  perm.mockResolvedValue(true);
  staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
});

describe("ops door", () => {
  it("sends someone without clinical_staff.manage away without calling the database", async () => {
    perm.mockResolvedValue(false);
    expect(await goes(opsSuspendAction(fd({ staff: ID, reason: "a long enough reason" })))).toBe("REDIRECT:/admin");
    expect(await goes(opsRequestAction(fd({ staff: ID, kind: "reinstatement", reason: "a long enough reason" })))).toBe("REDIRECT:/admin");
    expect(perm).toHaveBeenCalledWith("clinical_staff.manage");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("suspends with a reason through the ops function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(opsSuspendAction(fd({ staff: ID, reason: "a long enough reason" })))).toBe("REDIRECT:/admin/ops/clinicians?n=suspended");
    expect(rpc).toHaveBeenCalledWith("ops_suspend_clinician", { p_staff: ID, p_reason: "a long enough reason" });
  });
  it("refuses a short reason before the database", async () => {
    expect(await goes(opsSuspendAction(fd({ staff: ID, reason: "short" })))).toBe("REDIRECT:/admin/ops/clinicians?n=suspend_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a database refusal is a failure notice, not a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(opsSuspendAction(fd({ staff: ID, reason: "a long enough reason" })))).toBe("REDIRECT:/admin/ops/clinicians?n=suspend_failed");
  });
  it("asks for a competency with its code, and for a reinstatement without one", async () => {
    rpc.mockResolvedValue({ data: ID, error: null });
    expect(await goes(opsRequestAction(fd({ staff: ID, kind: "competency_grant", competency: "hypertension", reason: "a long enough reason" })))).toBe("REDIRECT:/admin/ops/clinicians?n=requested");
    expect(rpc).toHaveBeenLastCalledWith("request_clinician_change", { p_staff: ID, p_kind: "competency_grant", p_competency: "hypertension", p_reason: "a long enough reason" });
    await goes(opsRequestAction(fd({ staff: ID, kind: "reinstatement", competency: "hypertension", reason: "a long enough reason" })));
    expect(rpc).toHaveBeenLastCalledWith("request_clinician_change", { p_staff: ID, p_kind: "reinstatement", p_competency: null, p_reason: "a long enough reason" });
  });
  it("a competency request without a competency never reaches the database", async () => {
    expect(await goes(opsRequestAction(fd({ staff: ID, kind: "competency_grant", reason: "a long enough reason" })))).toBe("REDIRECT:/admin/ops/clinicians?n=request_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("clinical lead door", () => {
  it("sends a non-lead away without calling the database", async () => {
    staff.mockResolvedValue(null);
    expect(await goes(leadGrantAction(fd({ staff: ID, competency: "hypertension" })))).toBe("REDIRECT:/clinician");
    expect(await goes(leadReinstateAction(fd({ staff: ID, reason: "a long enough reason" })))).toBe("REDIRECT:/clinician");
    expect(await goes(leadDecideAction(fd({ request: REQ, decision: "approve" })))).toBe("REDIRECT:/clinician");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("approves and declines through the decision function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(leadDecideAction(fd({ request: REQ, decision: "approve" })))).toBe("REDIRECT:/clinician/roster?n=decided");
    expect(rpc).toHaveBeenLastCalledWith("decide_clinician_change", { p_request: REQ, p_approve: true, p_note: null });
    await goes(leadDecideAction(fd({ request: REQ, decision: "decline", note: "not enough training yet" })));
    expect(rpc).toHaveBeenLastCalledWith("decide_clinician_change", { p_request: REQ, p_approve: false, p_note: "not enough training yet" });
  });
  it("a decline needs a note before the database", async () => {
    rpc.mockClear();
    expect(await goes(leadDecideAction(fd({ request: REQ, decision: "decline", note: "no" })))).toBe("REDIRECT:/clinician/roster?n=decide_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refused approval (for example no renewed licence) is a failure notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "record the renewed licence first", code: "23514" } });
    expect(await goes(leadDecideAction(fd({ request: REQ, decision: "approve" })))).toBe("REDIRECT:/clinician/roster?n=decide_failed");
  });
  it("grants a competency directly through the S15 function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(leadGrantAction(fd({ staff: ID, competency: "hypertension" })))).toBe("REDIRECT:/clinician/roster?n=granted");
    expect(rpc).toHaveBeenCalledWith("grant_clinician_competency", { p_staff: ID, p_code: "hypertension" });
  });
});

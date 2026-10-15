const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import {
  createTermsAction,
  disputeStatementAction,
  issueSettlementAction,
  patientMessagePharmacyAction,
  reinstatePartnerAction,
  recordPaidAction,
  runSettlementAction,
} from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
beforeEach(() => rpc.mockReset());

describe("reinstatePartnerAction", () => {
  it("needs a written reason before it touches the database", async () => {
    expect(await reinstatePartnerAction(undefined, fd({ kind: "lab", partner: P, reason: "ok" }))).toEqual({ error: "Please give a reason of at least 20 characters." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes the reason through and reports success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await reinstatePartnerAction(undefined, fd({ kind: "lab", partner: P, reason: "Licence renewed, certificate seen on 6 October" }))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("reinstate_partner", { p_kind: "lab", p_id: P, p_reason: "Licence renewed, certificate seen on 6 October" });
  });
  it("an expired licence refusal is shown in words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "licence_expired_renew_first" } });
    const out = await reinstatePartnerAction(undefined, fd({ kind: "pharmacy", partner: P, reason: "Reinstating after the owner called us today" }));
    expect(out?.error).toMatch(/Renew it first/);
  });
});

describe("settlement actions move no money", () => {
  it("issuing calls only issue_settlement", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await issueSettlementAction(undefined, fd({ id: ID }))).toEqual({ success: true });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["issue_settlement"]);
  });
  it("recording a payment needs the bank reference and calls only record_settlement_paid", async () => {
    expect(await recordPaidAction(undefined, fd({ id: ID, reference: "x" }))).toHaveProperty("error");
    rpc.mockResolvedValue({ data: null, error: null });
    await recordPaidAction(undefined, fd({ id: ID, reference: "GTB-77841-2026" }));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["record_settlement_paid"]);
  });
  it("a guard that is off is said plainly", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "settlement_guard_off" } });
    expect((await runSettlementAction(undefined, fd({ month: "2026-09" })))?.error).toMatch(/not switched on/);
    expect(rpc).toHaveBeenCalledWith("run_partner_settlement", { p_month: "2026-09-01" });
  });
  it("a fixed share typed in naira is sent as whole kobo and a percentage as basis points", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const base = { kind: "pharmacy", partner: P, catalog_code: "care_pack_90", source: "pharmacy_margin", reason: "Agreed with the pharmacy in writing on 1 October", sponsor_paid_only: "on" };
    await createTermsAction(undefined, fd({ ...base, basis: "fixed_kobo", value: "1,250.50" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_basis: "fixed_kobo", p_value: 125050, p_sponsor_paid_only: true });
    await createTermsAction(undefined, fd({ ...base, basis: "basis_points", value: "12.5" }));
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_basis: "basis_points", p_value: 1250 });
  });
  it("terms for a laboratory never reach the database", async () => {
    const out = await createTermsAction(undefined, fd({ kind: "lab", partner: P, catalog_code: "care_pack_90", source: "pharmacy_margin", basis: "fixed_kobo", value: "100", reason: "Agreed with the pharmacy in writing on 1 October" }));
    expect(out).toHaveProperty("error");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("partner and patient messages", () => {
  it("a partner dispute needs words", async () => {
    expect(await disputeStatementAction(undefined, fd({ id: ID, note: "no" }))).toHaveProperty("error");
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await disputeStatementAction(undefined, fd({ id: ID, note: "Two lines on the 12th look duplicated" }))).toEqual({ success: true });
  });
  it("a patient message goes to the one function and a closed chat is said plainly", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "chat_closed" } });
    const out = await patientMessagePharmacyAction(undefined, fd({ prescription: ID, body: "Is the tablet strength right?" }));
    expect(out?.error).toMatch(/closed/);
    expect(rpc).toHaveBeenCalledWith("patient_send_pharmacy_message", { p_prescription: ID, p_body: "Is the tablet strength right?" });
  });
});

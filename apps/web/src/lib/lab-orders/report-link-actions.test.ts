const rpc = jest.fn();
const getCurrentUser = jest.fn();
const revalidatePath = jest.fn();

jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }),
  getCurrentUser: () => getCurrentUser(),
}));

import { linkReportToLabOrder } from "./report-link-actions";

const doc = "11111111-1111-4111-8111-111111111111";
const order = "22222222-2222-4222-8222-222222222222";
const patient = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
  getCurrentUser.mockReset().mockResolvedValue({ id: patient });
});

describe("linkReportToLabOrder", () => {
  it("passes the document and request to the database function on the caller's own session", async () => {
    rpc.mockResolvedValue({ data: { ok: true, lab_order_id: order, order_status: "resulted" }, error: null });
    const r = await linkReportToLabOrder({ documentId: doc, labOrderId: order, patientId: patient });
    expect(rpc).toHaveBeenCalledWith("link_clinical_document_to_lab_order", { p_document: doc, p_lab_order: order });
    expect(r).toEqual({ success: true, orderStatus: "resulted" });
    expect(revalidatePath).toHaveBeenCalledWith(`/clinician/patients/${patient}`);
  });

  it("sends null to record that the report answers no request", async () => {
    rpc.mockResolvedValue({ data: { ok: true, lab_order_id: null, order_status: null }, error: null });
    await linkReportToLabOrder({ documentId: doc, labOrderId: null });
    expect(rpc).toHaveBeenCalledWith("link_clinical_document_to_lab_order", { p_document: doc, p_lab_order: null });
  });

  it("refuses a malformed id before calling the database", async () => {
    const r = await linkReportToLabOrder({ documentId: "not-a-uuid", labOrderId: order });
    expect(r.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    getCurrentUser.mockResolvedValue(null);
    const r = await linkReportToLabOrder({ documentId: doc, labOrderId: order });
    expect(r.error).toMatch(/Sign in/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a database refusal as a plain sentence, never the raw error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "lab_order_link_order_not_open" } });
    const r = await linkReportToLabOrder({ documentId: doc, labOrderId: order });
    expect(r.error).toMatch(/cancelled or not paid/);
    expect(r.success).toBeUndefined();
  });
});

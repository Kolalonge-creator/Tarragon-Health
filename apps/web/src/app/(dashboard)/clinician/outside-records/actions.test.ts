const rpc = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
  getCurrentUser: () => getCurrentUser(),
}));

import { decideOutsideRecordAction } from "./actions";

const DOC = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({ id: "doc-1" });
});

describe("decideOutsideRecordAction", () => {
  it("sends the decision to the one database function and returns the status", async () => {
    rpc.mockResolvedValue({ data: { status: "verified" }, error: null });
    const r = await decideOutsideRecordAction({ documentId: DOC, outcome: "verified", note: "Matches the summary" });
    expect(rpc).toHaveBeenCalledWith("verify_outside_record", { p_document: DOC, p_outcome: "verified", p_note: "Matches the summary" });
    expect(r).toEqual({ success: true, status: "verified" });
  });

  it("does not call the database for a bad id or outcome", async () => {
    expect((await decideOutsideRecordAction({ documentId: "nope", outcome: "verified" })).error).toBeDefined();
    expect((await decideOutsideRecordAction({ documentId: DOC, outcome: "approved" })).error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a reason before it says a record could not be checked", async () => {
    const r = await decideOutsideRecordAction({ documentId: DOC, outcome: "not_verified" });
    expect(r.error).toMatch(/why/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a refusal for a doctor off the care team is an error the doctor sees, never a success", async () => {
    // the database RETURNS this (it must keep its denied-read audit row), so the action has to read it
    rpc.mockResolvedValue({ data: { status: "refused" }, error: null });
    const r = await decideOutsideRecordAction({ documentId: DOC, outcome: "verified" });
    expect(r.success).toBeUndefined();
    expect(r.error).toMatch(/care team/);
  });

  it("an unexpected answer is not treated as a success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await decideOutsideRecordAction({ documentId: DOC, outcome: "verified" })).success).toBeUndefined();
    rpc.mockResolvedValue({ data: { status: "something else" }, error: null });
    expect((await decideOutsideRecordAction({ documentId: DOC, outcome: "verified" })).success).toBeUndefined();
  });

  it("maps 'already checked' and 'not authorised' to plain sentences", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "this document has already been checked" } });
    expect((await decideOutsideRecordAction({ documentId: DOC, outcome: "verified" })).error).toMatch(/already checked/);
    rpc.mockResolvedValue({ data: null, error: { message: "not authorised" } });
    expect((await decideOutsideRecordAction({ documentId: DOC, outcome: "verified" })).error).toMatch(/care-team doctor/);
  });

  it("refuses when nobody is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await decideOutsideRecordAction({ documentId: DOC, outcome: "verified" })).error).toBe("Not signed in");
    expect(rpc).not.toHaveBeenCalled();
  });
});

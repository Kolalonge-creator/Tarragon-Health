/** Hand-over at 18 and ending proxy access (S42): input checked, the caller's own session, failures reported. */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@sentry/nextjs", () => ({ captureMessage: jest.fn() }));

const rpcMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({ rpc: (...args: unknown[]) => rpcMock(...args) })),
}));

import { completeHandoverAction } from "./handover-actions";
import { endProxyAccessAction } from "./proxy-arrangement-actions";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

beforeEach(() => rpcMock.mockReset().mockResolvedValue({ data: { ok: true }, error: null }));

describe("completeHandoverAction", () => {
  it("sends only the guardians the young person chose to keep", async () => {
    expect(await completeHandoverAction({ keep: [UUID] })).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("complete_dependant_handover", { p_keep: [UUID] });
  });
  it("an empty choice ends everyone's access (the default)", async () => {
    expect(await completeHandoverAction({ keep: [] })).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("complete_dependant_handover", { p_keep: [] });
  });
  it("refuses a value that is not a list of ids", async () => {
    expect((await completeHandoverAction({ keep: ["someone"] }))?.error).toBe(true);
    expect((await completeHandoverAction({}))?.error).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("reports a database refusal", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23514", message: "handover_not_yet" } });
    expect((await completeHandoverAction({ keep: [] }))?.error).toBe(true);
  });
});

describe("endProxyAccessAction", () => {
  it("ends the arrangement with the proposed cooling-off days", async () => {
    expect(await endProxyAccessAction({ grantId: UUID })).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("end_proxy_access", { p_grant: UUID, p_block_days: 30 });
  });
  it("refuses anything that is not a grant id", async () => {
    expect((await endProxyAccessAction({ grantId: "x" }))?.error).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("reports a failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0002", message: "proxy_arrangement_not_found" } });
    expect((await endProxyAccessAction({ grantId: UUID }))?.error).toBe(true);
  });
});

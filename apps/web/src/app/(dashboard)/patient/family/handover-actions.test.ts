/**
 * The young person's side of the hand-over (S04b-1, R3). Pinned here: accepting sends the hand-over id AND the date of
 * birth (a second factor, since the number alone is whatever the guardian typed); a mismatch is reported calmly and is
 * not a success; a missing date never reaches the database; declining sends the id only.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpcMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import { acceptHandoverAction, declineHandoverAction } from "./handover-actions";

const ID = "6f1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e11";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => rpcMock.mockReset().mockResolvedValue({ data: true, error: null }));

describe("acceptHandoverAction", () => {
  it("sends the hand-over id and date of birth, and nothing else from the form", async () => {
    const result = await acceptHandoverAction(undefined, form({ handoverId: ID, dateOfBirth: "2008-03-04", extra: "x" }));
    expect(result).toEqual({ done: "accepted" });
    expect(rpcMock).toHaveBeenCalledWith("accept_dependant_handover", { p_handover: ID, p_date_of_birth: "2008-03-04" });
  });

  it("a date of birth that does not match is an error, not an acceptance", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const result = await acceptHandoverAction(undefined, form({ handoverId: ID, dateOfBirth: "2008-03-05" }));
    expect(result).toEqual({ error: expect.stringContaining("does not match") });
  });

  it("never calls the database without a date of birth", async () => {
    expect(await acceptHandoverAction(undefined, form({ handoverId: ID }))).toEqual({ error: expect.stringContaining("date of birth") });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reports a refusal from the database", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "this hand-over cannot be accepted" } });
    expect(await acceptHandoverAction(undefined, form({ handoverId: ID, dateOfBirth: "2008-03-04" }))).toEqual({
      error: expect.stringContaining("could not complete"),
    });
  });
});

describe("declineHandoverAction", () => {
  it("sends the hand-over id only", async () => {
    expect(await declineHandoverAction(undefined, form({ handoverId: ID }))).toEqual({ done: "declined" });
    expect(rpcMock).toHaveBeenCalledWith("decline_dependant_handover", { p_handover: ID });
  });
});

const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { withdrawNoteAsEnteredInError } from "./note-actions";

const id = "11111111-1111-4111-8111-111111111111";

beforeEach(() => rpc.mockReset());

describe("withdrawNoteAsEnteredInError", () => {
  it("refuses a short reason without calling the database", async () => {
    const r = await withdrawNoteAsEnteredInError({ noteId: id, reason: "oops" });
    expect(r?.error).toMatch(/reason/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a note id that is not a uuid", async () => {
    const r = await withdrawNoteAsEnteredInError({ noteId: "nope", reason: "Wrong patient chart" });
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the RPC with exactly p_note and p_reason, trimmed", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await withdrawNoteAsEnteredInError({ noteId: id, reason: "  Written on the wrong patient  " });
    expect(r?.message).toBeDefined();
    expect(rpc).toHaveBeenCalledWith("mark_note_entered_in_error", { p_note: id, p_reason: "Written on the wrong patient" });
  });

  it.each([
    ["note_withdraw_author_or_cmo", /wrote this note|Chief Medical Officer/],
    ["note_withdraw_reason_needed", /reason/],
    ["note_already_withdrawn", /already been withdrawn/],
    ["only a signed note can be withdrawn; delete a draft by editing it", /signed note/],
  ])("maps %s to plain words", async (message, expected) => {
    rpc.mockResolvedValue({ data: null, error: { message, code: "P0001" } });
    const r = await withdrawNoteAsEnteredInError({ noteId: id, reason: "Written on the wrong patient" });
    expect(r?.error).toMatch(expected);
    expect(r?.error).not.toContain("note_withdraw");
  });
});

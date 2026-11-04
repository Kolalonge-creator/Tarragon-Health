/**
 * saveFamilyNoteAction (2026-11-03): Zod first (a bad id, an empty or over-long line never reaches the database), then the doctor's own
 * session calls write_family_note and the database policy decides. Refusals come back as short codes, never a database message.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();
const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({ rpc, auth: { getUser } })),
}));

import { saveFamilyNoteAction } from "./family-note-actions";

const ENC = "0b3a9f2e-6f1c-4c8e-9a51-7d2c1e4b5f60";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("saveFamilyNoteAction", () => {
  it("saves a trimmed line through the doctor's own session", async () => {
    rpc.mockResolvedValue({ data: "n1", error: null });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "  She did well today.  " })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("write_family_note", { p_encounter: ENC, p_body: "She did well today." });
  });

  it("never calls the database for a bad id, an empty line or an over-long line", async () => {
    await expect(saveFamilyNoteAction({ encounterId: "nope", body: "x" })).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "   " })).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "a".repeat(281) })).resolves.toEqual({ ok: false, reason: "too_long" });
    await expect(saveFamilyNoteAction(null)).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller before calling the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "x" })).resolves.toEqual({ ok: false, reason: "signed_out" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's refusals to short codes and never passes the message on", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "x" })).resolves.toEqual({ ok: false, reason: "not_allowed" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23502", message: "null value in column author_staff_id" } });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "x" })).resolves.toEqual({ ok: false, reason: "not_allowed" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "check" } });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "x" })).resolves.toEqual({ ok: false, reason: "too_long" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(saveFamilyNoteAction({ encounterId: ENC, body: "x" })).resolves.toEqual({ ok: false, reason: "failed" });
  });
});
